const http = require("https");

function getDocuments(projectId, collectionName) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?pageSize=100`;
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", (err) => reject(err));
  });
}

async function main() {
  for (const env of ["archery101010-tst", "archery101010-prd"]) {
    console.log(`\n--- Fetching users from REST API for ${env} ---`);
    try {
      const res = await getDocuments(env, "users");
      if (res.documents) {
        console.log(`Found ${res.documents.length} documents:`);
        res.documents.forEach((doc) => {
          const fields = doc.fields;
          const uid = fields.uid ? fields.uid.stringValue : "N/A";
          const fullName = fields.fullName ? fields.fullName.stringValue : "N/A";
          const email = fields.email ? fields.email.stringValue : "N/A";
          const lastActiveAt = fields.lastActiveAt ? fields.lastActiveAt.integerValue || fields.lastActiveAt.doubleValue : null;
          console.log(`- Document ID: ${doc.name.split("/").pop()}, UID: ${uid}, Name: ${fullName}, Email: ${email}, lastActiveAt: ${lastActiveAt}`);
        });
      } else {
        console.log("No documents found in users collection.");
      }
    } catch (e) {
      console.error(`Error fetching from ${env}:`, e.message);
    }
  }
}

main();
