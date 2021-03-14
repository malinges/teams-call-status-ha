import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Observable } from 'rxjs';
import { distinctUntilChanged, map, startWith, throttleTime } from 'rxjs/operators';

const LOG_FILE = path.resolve(os.homedir(), 'Library/Application Support/Microsoft/Teams/logs.txt');

const watch = (filename: fs.PathLike) =>
  new Observable<void>((observer) => {
    const watcher = fs.watch(filename);
    watcher.on('change', () => observer.next());
    watcher.on('error', (err) => observer.error(err));
    watcher.on('close', () => observer.complete());
    return () => watcher.close();
  });

const getLastCallStatus = (filename: fs.PathLike): boolean =>
  fs
    .readFileSync(filename, { encoding: 'utf8' })
    .split(/(?:\r\n|\r|\n)/)
    .filter((line) => line.match(/eventData: s::;m::1;a::[13]/))
    .pop()!
    .match(/eventData: s::;m::1;a::1/) != null;

const watchCallStatus = (filename: fs.PathLike) =>
  watch(filename).pipe(
    startWith(undefined),
    throttleTime(1000),
    map(() => getLastCallStatus(filename)),
    distinctUntilChanged(),
  );

watchCallStatus(LOG_FILE).subscribe((inCall) => console.log(`in call: ${inCall}`));
