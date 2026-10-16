/** GOD persona for the Ira command plane (FR-011). */
export const IRA_PERSONA = {
  callsign: "Ira",
  expansion: "Intelligent Resource Automation",
} as const;

export type IraPersonaField = {
  callsign: typeof IRA_PERSONA.callsign;
  expansion: typeof IRA_PERSONA.expansion;
};

/** Persona object for hive manifest and API success envelopes. */
export function personaField(): IraPersonaField {
  return {
    callsign: IRA_PERSONA.callsign,
    expansion: IRA_PERSONA.expansion,
  };
}
