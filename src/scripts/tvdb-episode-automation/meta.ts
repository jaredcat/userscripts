import { UserScriptMetadata } from '../../types';

const metadata: UserScriptMetadata = {
  name: 'TVDB Episode Input Automation',
  version: '0.0.2',
  description: 'Automates episode input process on TVDB',
  match: ['*://thetvdb.com/series/*/episodes/add*'],
};
export default metadata;
