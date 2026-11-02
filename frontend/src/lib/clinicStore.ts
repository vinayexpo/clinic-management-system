let clinic = { name: "", countryCode: "91" };

/** Store the clinic details used when building WhatsApp messages. */
export function setClinicDetails(details: { name: string; countryCode?: string }): void {
  clinic = { name: details.name, countryCode: details.countryCode || "91" };
}

export function getClinicDetails(): { name: string; countryCode: string } {
  return clinic;
}
