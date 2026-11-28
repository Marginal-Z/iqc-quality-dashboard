import { WorkerEntrypoint } from 'cloudflare:workers';
import worker from './worker.mjs';
import { runDirectoryCycle } from './directory.mjs';
export class DirectorySource extends WorkerEntrypoint {
  async sync() { return runDirectoryCycle(this.env); }
}
export default worker;
