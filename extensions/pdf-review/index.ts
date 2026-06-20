import { registerPdfReviewTools } from './src/tools.js';

export default function pdfReviewExtension(pi: any): void {
  registerPdfReviewTools(pi);
}
