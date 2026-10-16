export type MorningBriefInput = {
  done: number;
  blocked: number;
  doing: number;
  openAskMe: number;
  pollIntervalMs: number;
  awayMode: boolean;
};

export function buildMorningBriefLines(input: MorningBriefInput): string[] {
  const countsLine = `${input.done} done. ${input.blocked} blocked. ${input.doing} in progress.`;
  const workLines =
    input.done === 0 && input.blocked === 0 && input.doing === 0
      ? ["Nothing in flight.", countsLine]
      : [countsLine];

  const needsYou =
    input.openAskMe === 0
      ? "Needs you: nothing."
      : `Needs you: ${input.openAskMe}.`;

  const nextTrigger = input.awayMode
    ? `Next trigger: away poll every ${input.pollIntervalMs} ms.`
    : "Next trigger: nothing scheduled.";

  return [
    ...workLines,
    "Spend: none recorded. Quota: unknown.",
    needsYou,
    nextTrigger,
  ];
}
