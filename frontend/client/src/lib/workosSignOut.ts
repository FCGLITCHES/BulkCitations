type WorkOSSignOutFn = () => Promise<void>;

let workOSSignOut: WorkOSSignOutFn | null = null;

export function registerWorkOSSignOut(fn: WorkOSSignOutFn | null) {
  workOSSignOut = fn;
}

export async function signOutWorkOSSession(): Promise<void> {
  if (!workOSSignOut) {
    return;
  }
  await workOSSignOut().catch(() => {});
}
