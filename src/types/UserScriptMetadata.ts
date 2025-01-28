export interface UserScriptMetadata {
  name: string;
  version: string;
  description: string;
  match: string[];
  namespace?: string;
  author?: string;
  updateURL?: string;
  downloadURL?: string;
  license?: string;
}
