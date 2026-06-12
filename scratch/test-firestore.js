const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");

const firebaseConfigs = {
  test: {
    apiKey: "AIzaSyDXsjd5FRo-WpE4-32hJnyZSvqlW-88I0E",
    authDomain: "archery101010-tst.firebaseapp.com",
    projectId: "archery101010-tst",
    storageBucket: "archery101010-tst.firebasestorage.app",
    messagingSenderId: "205974427894",
    appId: "1:205974427894:web:16aee6e14fb8ad49f534d7"
  },
  prod: {
    apiKey: "AIzaSyBYrK69NQRfuSR73HF_lJP22g1bw0LDPTo",
    authDomain: "archery101010-prd.firebaseapp.com",
    projectId: "archery101010-prd",
    storageBucket: "archery101010-prd.firebasestorage.app",
    messagingSenderId: "201321373574",
    appId: "1:201321373574:web:f9c4aba8b9e86e5835d607"
  }
};

async function queryUsers(env) {
  console.log(`\n--- Querying ${env.toUpperCase()} users ---`);
  const app = initializeApp(firebaseConfigs[env], env);
  const db = getFirestore(app);
  
  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    console.log(`Found ${querySnapshot.size} users:`);
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`- UID: ${doc.id}, Name: ${data.fullName}, Email: ${data.email}, lastActiveAt: ${data.lastActiveAt} (${data.lastActiveAt ? new Date(data.lastActiveAt).toISOString() : 'none'})`);
    });
  } catch (err) {
    console.error(`Error querying ${env}:`, err);
  }
}

async function main() {
  await queryUsers("test");
  await queryUsers("prod");
}

main();
