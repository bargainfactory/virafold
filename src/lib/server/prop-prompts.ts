import type { PropType } from "./db";

/** Prop-type registry shared by the personas routes and the character builder. */
export const PTYPES = new Set<PropType>([
  "presenter",
  "character",
  "product",
  "setting",
  "style",
  "archival",
]);

/** Generation wrapper per prop type — what the image provider is asked for. */
export const GEN_WRAP: Record<PropType, (p: string) => string> = {
  presenter: (p) =>
    `Photorealistic UGC creator portrait: ${p}. Person facing the camera, head and shoulders, natural smartphone-video look, soft daylight, believable casual setting, vertical 9:16 composition, no text, no watermark.`,
  character: (p) =>
    `Original character design, reference-sheet quality: ${p}. Full body visible, facing the viewer, expressive pose, clean plain background, consistent design, vertical 9:16 composition, no text, no watermark.`,
  product: (p) =>
    `Clean product photograph: ${p}. Product centered and fully visible, soft studio lighting, plain uncluttered background, vertical 9:16 composition, no text, no watermark.`,
  setting: (p) =>
    `Establishing shot of ${p}. No people, atmospheric lighting, vertical 9:16 composition, no text, no watermark.`,
  style: (p) => `${p}. Vertical 9:16 composition, no text, no watermark.`,
  archival: (p) =>
    `Archival photograph of ${p}, authentic documentary feel, natural film grain, vertical 9:16 composition, no text, no watermark.`,
};

/** Vision instruction per prop type — what gets injected into scene prompts. */
export const VISION: Record<PropType, string> = {
  presenter:
    "Describe this person's appearance in under 50 words, visual facts only: apparent age range, hair, outfit, setting, lighting. No name, no judgments.",
  character:
    "Describe this character's visual design in under 50 words: kind of character, build, outfit, signature colors, distinctive features. Visual facts only, no name, no backstory.",
  product:
    "Describe this product visually in under 40 words: what it is, shape, colors, materials, label placement. Do not invent brand names or claims not visible.",
  setting:
    "Describe this place in under 40 words: type of space, key objects, materials, lighting, mood. Visual facts only.",
  style:
    "Describe the visual STYLE of this image in under 60 words: medium (photo/2D/3D), line quality, color palette, lighting, composition habits, overall mood. Do NOT describe the specific characters or subjects — style only.",
  archival:
    "Describe this photo in under 40 words: subject, setting, era cues, lighting. Visual facts only.",
};
