# Firebase Cloud Functions

Cloud functions to aggregate and batch edit the tracking data for charlietango.dk.

## Commands

- Deploy the functions to the [Firebase console](https://console.firebase.google.com/project/charlie-tango-dk-stats/functions/list):

```sh
firebase deploy --only functions
```

- Test the functions locally (though potentially using production data):

```sh
firebase emulators:start
```

- Build your functions to ensure whatever you're emulating is up to date with your saved work:

```sh
cd functions
npm run build
```
