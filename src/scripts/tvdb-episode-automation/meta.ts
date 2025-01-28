import { UserScriptMetadata } from '../../types';

const metadata: UserScriptMetadata = {
  name: 'TVDB Episode Input Automation',
  version: '1.0.0',
  description: 'Automates episode input process on TVDB',
  match: ['*://thetvdb.com/series/*/episodes/add*'],
};
export default metadata;
