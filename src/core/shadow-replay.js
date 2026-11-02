// Compatibility entry point: the former arithmetic simulator was not calibrated
// against a database and must not produce execution-time or outage predictions.
class ShadowReplaySimulator {
  static simulate(){
    throw Object.assign(new Error('Uncalibrated simulation has been removed. Use check for static findings and measure runtime on a representative PostgreSQL database.'),{statusCode:410});
  }
}
module.exports=ShadowReplaySimulator;
