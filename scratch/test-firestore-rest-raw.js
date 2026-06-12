const http = require("https");

function fetchRaw(projectId, collectionName) {
  return new Promise((resolve) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?pageSize=100`;
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    }).on("error", (err) => resolve({ error: err.message }));
  });
}

async function main() {
  for (const env of ["archery101010-tst", "archery101010-prd"]) {
    console.log(`\n--- Raw REST response for ${env} ---`);
    const res = await fetchRaw(env, "users");
    console.log("Status Code:", res.statusCode);
    if (res.error) {
      console.error("HTTP/Network Error:", res.error);
    } else {
      try {
        const json = JSON.parse(res.body);
        console.log("JSON Response keys:", Object.keys(json));
        if (json.error) {
          console.error("API Error:", json.error);
        } else if (json.documents) {
          console.log(`Found ${json.documents.length} documents. First document:`, JSON.stringify(json.documents[0], null, 2));
        } else {
          console.log("No documents. Full response:", res.body);
        }
      } catch (err) {
        console.error("Failed to parse JSON. Raw body:", res.body);
      }
    }
  }
}

main();
