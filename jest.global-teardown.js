// If Jest runs in parallel mode using workers (which is default) this runs in parent process
export default async function() {
  console.log('Running global teardown in parent process');
  // allow the process to exit even if stdin/stdout/stderr is still open
  ['stdin', 'stdout', 'stderr'].forEach(stream => {
    if (process[stream] && typeof process[stream].unref === 'function') {
      process[stream].unref();
    }
  });  
  console.log('Global teardown complete');
}