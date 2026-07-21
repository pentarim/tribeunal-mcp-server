import { z } from 'zod';
import { caseUuid, sideUuid } from './uuid.js';

const httpsImageUrl = z.string().url().refine((u) => u.startsWith('https://'), {
  message: 'Image URL must use https.',
}).describe('Public https URL of the image to fetch and attach (png, jpeg or webp, <= 5 MB). It is downloaded and re-encoded server-side; http, private hosts and non-images are rejected.');

export const SetSideImageSchema = z.object({
  caseId: caseUuid('Case UUID the side belongs to (the case\'s `uuid` field)'),
  sideId: sideUuid('Side UUID to set the image on (the side\'s `uuid` field)'),
  imageUrl: httpsImageUrl,
});
