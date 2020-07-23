import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

admin.initializeApp();
const firestore = admin.firestore();

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
