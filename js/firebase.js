import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, browserSessionPersistence, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, set, update, get, onValue, remove, serverTimestamp, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

// Sesión por pestaña: si recargas el móvil sigues siendo tú,
// y dos pestañas del mismo navegador cuentan como dos jugadores.
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getDatabase(app);

let offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
/** Hora del servidor en ms: todos los relojes de la partida usan esto. */
export const serverNow = () => Date.now() + offset;

export async function login() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}

export { ref, set, update, get, onValue, remove, serverTimestamp, onDisconnect };
