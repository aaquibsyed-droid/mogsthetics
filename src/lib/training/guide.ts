/**
 * Visual exercise guide: maps an exercise name to a movement pattern, with an
 * animated side-view figure (two poses) and plain-language form cues.
 */
export type Pattern = "squat" | "hinge" | "pushup" | "row" | "press" | "lunge" | "plank" | "bridge" | "cardio" | "calf" | "curl" | "stretch";

type Pt = [number, number];
/** Joints of a side-view stick figure in a 120×120 box (ground at y=110). */
export interface Pose {
  head: Pt;
  neck: Pt;
  hip: Pt;
  knee: Pt;
  ankle: Pt;
  knee2?: Pt;
  ankle2?: Pt;
  elbow: Pt;
  hand: Pt;
  elbow2?: Pt;
  hand2?: Pt;
}

const STAND: Pose = { head: [60, 20], neck: [60, 31], hip: [60, 62], knee: [60, 86], ankle: [60, 110], elbow: [60, 47], hand: [60, 62] };

export const POSES: Record<Pattern, [Pose, Pose]> = {
  squat: [
    { ...STAND, elbow: [68, 42], hand: [68, 33] },
    { head: [56, 44], neck: [56, 54], hip: [42, 80], knee: [68, 84], ankle: [60, 110], elbow: [66, 64], hand: [66, 55] },
  ],
  hinge: [
    STAND,
    { head: [93, 44], neck: [84, 47], hip: [48, 63], knee: [55, 87], ankle: [60, 110], elbow: [84, 63], hand: [84, 79] },
  ],
  pushup: [
    { head: [100, 70], neck: [90, 74], hip: [56, 87], knee: [38, 95], ankle: [18, 103], elbow: [90, 90], hand: [90, 106] },
    { head: [102, 90], neck: [92, 94], hip: [56, 99], knee: [38, 101], ankle: [18, 104], elbow: [78, 96], hand: [90, 106] },
  ],
  row: [
    { head: [92, 40], neck: [82, 44], hip: [48, 63], knee: [55, 87], ankle: [60, 110], elbow: [82, 61], hand: [82, 78] },
    { head: [92, 40], neck: [82, 44], hip: [48, 63], knee: [55, 87], ankle: [60, 110], elbow: [64, 46], hand: [74, 60] },
  ],
  press: [
    { ...STAND, elbow: [70, 42], hand: [66, 30] },
    { ...STAND, elbow: [64, 18], hand: [62, 4] },
  ],
  lunge: [
    { ...STAND, knee2: [58, 86], ankle2: [56, 110] },
    { head: [60, 38], neck: [60, 49], hip: [60, 79], knee: [80, 82], ankle: [80, 110], knee2: [50, 103], ankle2: [32, 108], elbow: [60, 64], hand: [60, 78] },
  ],
  plank: [
    { head: [100, 80], neck: [90, 84], hip: [56, 92], knee: [38, 97], ankle: [18, 103], elbow: [90, 104], hand: [102, 104] },
    { head: [100, 81], neck: [90, 85], hip: [56, 90], knee: [38, 96], ankle: [18, 103], elbow: [90, 104], hand: [102, 104] },
  ],
  bridge: [
    { head: [16, 102], neck: [27, 103], hip: [60, 104], knee: [78, 84], ankle: [88, 108], elbow: [42, 106], hand: [56, 107] },
    { head: [16, 102], neck: [27, 101], hip: [60, 80], knee: [80, 78], ankle: [88, 108], elbow: [42, 106], hand: [56, 107] },
  ],
  cardio: [
    { head: [62, 20], neck: [61, 31], hip: [58, 61], knee: [72, 78], ankle: [64, 100], knee2: [50, 84], ankle2: [40, 102], elbow: [52, 46], hand: [60, 56], elbow2: [70, 44], hand2: [78, 36] },
    { head: [62, 20], neck: [61, 31], hip: [58, 61], knee: [50, 84], ankle: [40, 102], knee2: [72, 78], ankle2: [64, 100], elbow: [70, 44], hand: [78, 36], elbow2: [52, 46], hand2: [60, 56] },
  ],
  calf: [STAND, { head: [60, 13], neck: [60, 24], hip: [60, 55], knee: [60, 79], ankle: [60, 103], elbow: [60, 40], hand: [60, 55] }],
  curl: [
    { ...STAND, elbow: [62, 48], hand: [64, 64] },
    { ...STAND, elbow: [62, 48], hand: [68, 36] },
  ],
  stretch: [
    { ...STAND, elbow: [72, 30], hand: [80, 18] },
    { ...STAND, hip: [60, 62], elbow: [50, 30], hand: [42, 18] },
  ],
};

const MATCH: Array<[Pattern, RegExp]> = [
  ["bridge", /bridge|hip thrust|glute/i],
  ["lunge", /lunge|split squat|step[- ]?up|bulgarian/i],
  ["squat", /squat|leg press|wall sit/i],
  ["hinge", /deadlift|rdl|hinge|good morning|swing|hip hinge/i],
  ["pushup", /push[- ]?up|press[- ]?up|dip/i],
  ["row", /row|pull[- ]?up|chin[- ]?up|pulldown|pull[- ]?down|face pull|pull[- ]?apart|reverse fly/i],
  ["press", /overhead|shoulder press|military|pike|lateral raise|arnold/i],
  ["curl", /curl|tricep|extension|kickback/i],
  ["calf", /calf/i],
  ["plank", /plank|dead[- ]?bug|crunch|hollow|bird dog|core|ab |abs|sit[- ]?up|leg raise|twist|pallof/i],
  ["pushup", /bench|chest press|floor press|fly/i],
  ["cardio", /walk|run|jog|bike|cycl|row(?:er|ing machine)|swim|interval|cardio|jump|burpee|stair|elliptical|hiit|skip|march|finisher/i],
  ["stretch", /stretch|mobility|yoga|warm[- ]?up|cool[- ]?down|foam/i],
];

export function patternFor(name: string): Pattern {
  if (/rower|rowing machine/i.test(name)) return "cardio";
  for (const [p, re] of MATCH) if (re.test(name)) return p;
  return "stretch";
}

export const CUES: Record<Pattern, string[]> = {
  squat: ["Feet shoulder-width, toes slightly out.", "Push hips back and bend knees, chest up.", "Lower until thighs are about parallel.", "Drive through your whole foot to stand."],
  hinge: ["Stand tall, soft knees, weight held close.", "Push hips back while keeping your back flat.", "Lower until you feel a hamstring stretch.", "Squeeze glutes to bring hips forward and stand."],
  pushup: ["Hands under shoulders, body in a straight line.", "Lower your chest with elbows about 45° from your body.", "Stop just above the floor.", "Push the floor away to the top. Use your knees to make it easier."],
  row: ["Hinge forward with a flat back, arm long.", "Pull your elbow back toward your hip.", "Squeeze your shoulder blade at the top.", "Lower slowly under control."],
  press: ["Brace your core, weights at shoulder height.", "Press straight up until arms are locked out.", "Keep ribs down; don't lean back.", "Lower slowly to your shoulders."],
  lunge: ["Stand tall, then take a long step.", "Lower until both knees are about 90°.", "Keep your front knee over your foot.", "Push through the front heel to return."],
  plank: ["Elbows under shoulders, legs straight.", "Squeeze glutes and brace like you're about to be poked.", "Keep a straight line from head to heels.", "Breathe slowly; stop if your hips sag."],
  bridge: ["Lie on your back, knees bent, feet flat.", "Press through your heels to lift your hips.", "Squeeze glutes at the top; don't arch your back.", "Lower slowly."],
  cardio: ["Start easy for 3–5 minutes.", "Work at a pace where talking is possible but not easy.", "Keep shoulders relaxed and posture tall.", "Ease off for the last few minutes."],
  calf: ["Stand tall, balls of feet on the floor or a step.", "Rise as high as you can onto your toes.", "Pause for a second at the top.", "Lower slowly all the way down."],
  curl: ["Stand tall, elbows tucked at your sides.", "Bend or straighten only at the elbow.", "Squeeze at the end of the movement.", "Return slowly; don't swing."],
  stretch: ["Move slowly into the position.", "Stop at a gentle stretch, never pain.", "Breathe out as you go a little deeper.", "Hold 20–30 seconds per side."],
};

export function guideFor(name: string): { pattern: Pattern; cues: string[] } {
  const pattern = patternFor(name);
  return { pattern, cues: CUES[pattern] };
}
