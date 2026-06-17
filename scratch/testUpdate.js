const https = require('https');

function patchDocument(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: responseBody
        });
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

async function run() {
  try {
    const docId = "USR-1781324372253-FF2ILX";
    const updateUrl = `https://firestore.googleapis.com/v1/projects/archery101010-prd/databases/(default)/documents/users/${docId}?updateMask.fieldPaths=lastActiveAt`;
    
    const payload = {
      fields: {
        lastActiveAt: {
          integerValue: Date.now().toString()
        }
      }
    };

    console.log(`Sending PATCH request to update lastActiveAt for ${docId}...`);
    const res = await patchDocument(updateUrl, payload);
    console.log("Response Status Code:", res.statusCode);
    console.log("Response Body:", res.body);
  } catch (err) {
    console.error("Error updating document:", err);
  }
}

run();
