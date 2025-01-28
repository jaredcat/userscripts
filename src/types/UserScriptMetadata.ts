export interface UserScriptMetadata {
  name: string;
  namespace?: string;
  version: string;
  description: string;
  author?: string;
  match: string[];
  updateURL?: string;
  downloadURL?: string;
}
