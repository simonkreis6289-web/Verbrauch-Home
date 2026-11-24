const firebaseConfig = {
  apiKey: "AIzaSyBrKjajSNPgmFUwjMghkox1kM8NjbCWZ_Y",
  authDomain: "verbrauch-zuhause.firebaseapp.com",
  projectId: "verbrauch-zuhause",
  appId: "1:546121139332:web:b07b58184fb0388565aed1"
};
export const householdKey = "verbrauch-household-id-v1";
export const snapshotKey = "verbrauch-local-data-v8";
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function readLocalSnapshot() {
  try { return JSON.parse(readStorage(snapshotKey)); } catch { return null; }
}

export function householdId() {
  return readStorage(householdKey) || "zuhause-haupt";
}

export async function connectDashboard() {
  const [firebase, firestore] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js")
  ]);
  const db = firestore.getFirestore(firebase.initializeApp(firebaseConfig));
  return { firestore, db, base: "households/" + householdId() };
}
