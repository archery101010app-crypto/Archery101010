const https = require('https');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function run() {
  try {
    console.log("Fetching users from PRD...");
    const prdData = await getJSON("https://firestore.googleapis.com/v1/projects/archery101010-prd/databases/(default)/documents/users?pageSize=100");
    console.log("PRD Users:");
    if (prdData.documents) {
      prdData.documents.forEach(doc => {
        const fields = doc.fields || {};
        const uid = fields.uid?.stringValue || doc.name.split('/').pop();
        const fullName = fields.fullName?.stringValue || 'N/A';
        const email = fields.email?.stringValue || 'N/A';
        const lastActiveAt = fields.lastActiveAt?.integerValue || fields.lastActiveAt?.doubleValue || fields.lastActiveAt?.stringValue || 'N/A';
        console.log(`- UID: ${uid} | Name: ${fullName} | Email: ${email} | lastActiveAt: ${lastActiveAt}`);
      });
    } else {
      console.log("No documents in PRD users collection.");
    }

    console.log("\nFetching users from TST...");
    const tstData = await getJSON("https://firestore.googleapis.com/v1/projects/archery101010-tst/databases/(default)/documents/users?pageSize=100");
    console.log("TST Users:");
    if (tstData.documents) {
      tstData.documents.forEach(doc => {
        const fields = doc.fields || {};
        const uid = fields.uid?.stringValue || doc.name.split('/').pop();
        const fullName = fields.fullName?.stringValue || 'N/A';
        const email = fields.email?.stringValue || 'N/A';
        const lastActiveAt = fields.lastActiveAt?.integerValue || fields.lastActiveAt?.doubleValue || fields.lastActiveAt?.stringValue || 'N/A';
        console.log(`- UID: ${uid} | Name: ${fullName} | Email: ${email} | lastActiveAt: ${lastActiveAt}`);
      });
    } else {
      console.log("No documents in TST users collection.");
    }
  } catch (err) {
    console.error("Error fetching users:", err);
  }
}

run();
