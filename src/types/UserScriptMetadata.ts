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
  icon?: string;
  run_at?: string;
  connect?: string[];
  require?: string;
}
