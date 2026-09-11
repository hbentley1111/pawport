import "server-only";
import { createPlacesClient } from "./google-client";
export function placesConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}
export function googlePlaces() {
  return createPlacesClient(process.env.GOOGLE_MAPS_API_KEY);
}
