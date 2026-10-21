import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Initialises the Firebase Admin SDK.
 * - With FIRESTORE_EMULATOR_HOST set, the SDK talks to the local emulator (no credentials needed).
 * - Otherwise it uses Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS).
 */
export function createFirestore(projectId: string): Firestore {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Skip google-auth's GCE metadata-server probe, which otherwise stalls the first request by seconds.
    process.env.METADATA_SERVER_DETECTION ??= 'none';
  }
  const existing = getApps()[0];
  const app: App =
    existing ??
    initializeApp(
      process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { projectId, credential: applicationDefault() },
    );
  return getFirestore(app);
}
