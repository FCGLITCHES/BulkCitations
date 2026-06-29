/**
 * AuthKit JS must POST to same-origin `/user_management/authenticate` (proxied to API in dev).
 */
export function getWorkOSAuthKitConnection() {
  if (typeof window === "undefined") {
    return { apiHostname: "localhost", port: 2397, https: false as boolean };
  }
  const { hostname, port, protocol } = window.location;
  const https = protocol === "https:";
  const portNum = port ? Number(port) : https ? 443 : 80;
  return { apiHostname: hostname, port: portNum, https };
}
