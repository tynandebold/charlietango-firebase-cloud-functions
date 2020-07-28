import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

import { chain, sumBy, uniq } from "lodash";

admin.initializeApp();
const firestore = admin.firestore();

type VisitorsByDate = {
  date: string;
  totalPageViews: number;
  uniqueVisitorIps: string[];
};

export const addInternalViewData = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    const viewsRef = firestore.collection("views");

    try {
      await firestore.runTransaction(async (t) => {
        const snapshot = await t.get(
          viewsRef
            .where("timestamp", "<", "2020-07-21T09:47:58.666Z")
            .orderBy("timestamp", "desc")
            .limit(1)
        );

        snapshot.forEach((doc) => {
          const docData = doc.data();

          if (!!docData.internalView) {
            return;
          } else {
            if (docData.ip === "80.62.20.6") {
              t.update(doc.ref, { internalView: true });
            } else {
              t.update(doc.ref, { internalView: false });
            }
          }
        });
      });

      console.log("Transaction success!");
      res.send("Transaction success!");
    } catch (e) {
      console.log("Transaction failure: ", e);
      res.send("Transaction failure.");
    }
  });

export const aggregateData = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const viewsRef = firestore
        .collection("views")
        .where("timestamp", "<", today);
      const snapshot = await viewsRef.get();
      const allTrackingData: Object[] = [];

      snapshot.forEach((doc) => {
        allTrackingData.push(doc.data());
      });

      /**
       * Create an object with unique keys representing page paths and values
       * counting the number of times that pages was viewed.
       */
      const topPagesObj = allTrackingData.reduce((acc: any, curr: any) => {
        acc[curr.page] ? acc[curr.page]++ : (acc[curr.page] = 1);

        return acc;
      }, {});

      /**
       * Using the topPagesObj, create an arry of top-page objects, sorted
       * from greatest to least.
       */
      const topPagesArr = Object.keys(topPagesObj)
        .map((key: string) => {
          return {
            pagePath: key,
            totalVisits: topPagesObj[key],
          };
        })
        .sort((a, b) => b.totalVisits - a.totalVisits);

      /**
       * Build an object of objects, with the inner ones each representing one
       * day of tracking data, comprised of page views and IP addresses.
       */
      const dataByDateObj = allTrackingData.reduce(
        (allData: any, oneDataPoint: any) => {
          const date = oneDataPoint.timestamp.split("T")[0];

          if (date in allData) {
            allData[date] = {
              count: allData[date].count + 1,
              ips: allData[date].ips.concat(oneDataPoint.ip),
            };
          } else {
            allData[date] = {
              count: 1,
              ips: [oneDataPoint.ip],
            };
          }

          return allData;
        },
        {}
      );

      /**
       * Turn the dataByDateObj into an array of objects, each containing the
       * date, total page views, and unique visitor IP address for that one day.
       */
      const visitorsByDay: Object[] = [];
      for (const key in dataByDateObj) {
        visitorsByDay.push({
          date: key,
          internalPageViews:
            dataByDateObj[key].ips.filter((i: any) => {
              return i === "80.62.20.6";
            }).length || 0,
          totalPageViews: dataByDateObj[key].count,
          uniqueVisitorIps: [
            ...Array.from(
              new Set(dataByDateObj[key].ips.map((i: string) => i))
            ),
          ],
        });
      }

      /**
       * For aggregation, create an array of objects of past months of tracking
       * data. First, filter out the current month's data, then group what's left
       * by month, and then build objects identical to that of visitorsByDay.
       */
      const currYearAndMonth = new Date().toISOString().slice(0, 7);
      const yearAndMonth = (item: any) => item.date.slice(0, 7);
      const visitorsByMonth = chain(visitorsByDay)
        .filter((item: any) => {
          return currYearAndMonth !== yearAndMonth(item);
        })
        .groupBy(yearAndMonth)
        .map((item: VisitorsByDate[], month: string) => {
          return {
            date: month,
            internalPageViews: sumBy(item, "internalPageViews"),
            totalPageViews: sumBy(item, "totalPageViews"),
            uniqueVisitorIps: item.reduce(
              (acc: VisitorsByDate[], curr: any) => {
                return uniq(acc.concat(curr.uniqueVisitorIps));
              },
              []
            ),
          };
        })
        .value();

      /**
       * Combine the visitorsByDay and visitorsByMonth arrays into one, taking
       * care to only use the current month's data from the visitorsByDay array.
       */
      const allVisitorData = visitorsByDay
        .filter((item: any) => {
          return item.date.includes(currYearAndMonth);
        })
        .concat(visitorsByMonth);

      /**
       * Delete the viewsByDate and topPages collections from Firestore before
       * we update them again. This is done so prevent duplicity. I see no
       * great way to update specific documents, at least not in a way
       * that is this efficient.
       */
      await deleteCollection(firestore, "viewsByDate", 50);
      await deleteCollection(firestore, "topPages", 50);

      /**
       * Write both the visitors and top-page data.
       */
      const writeVisitorData = allVisitorData.map(async (day) => {
        return await firestore.collection("viewsByDate").add(day);
      });

      const writeTopPageData = topPagesArr.map(async (page) => {
        return await firestore.collection("topPages").add(page);
      });

      /**
       * Wait for all the promises to resolve, then return successful.
       */
      Promise.all([writeVisitorData, writeTopPageData])
        .then(() => {
          console.log("Successfully aggregated the data!");
          res.status(200).send("Successfully aggregated the data!");
        })
        .catch((error) => {
          console.error(error.message);
        });
    } catch (err) {
      console.error("Failed to aggregate the data.", err);
      res.send("Failed to aggregate the data");
    }
  });

async function deleteCollection(
  db: FirebaseFirestore.Firestore,
  collectionPath: string,
  batchSize: number
) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy("__name__").limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(
  db: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
  resolve: any
) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    // When there are no documents left, we are done
    resolve();
    return;
  }

  // Delete documents in a batch
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // Recurse on the next process tick, to avoid
  // exploding the stack.
  process.nextTick(async () => {
    try {
      await deleteQueryBatch(db, query, resolve);
    } catch (error) {
      console.error("Problem deleting documents. ", error);
    }
  });
}
