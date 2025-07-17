import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCRAxSMSgri4v1-Gu_5chm7SZ3qbDU-oHI",
  authDomain: "link-saver-da951.firebaseapp.com",
  projectId: "link-saver-da951",
  storageBucket: "link-saver-da951.appspot.com",
  messagingSenderId: "367968137214",
  appId: "1:367968137214:web:87d264f365742d98331aaf",
  measurementId: "G-N2LGG7Y3TR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
