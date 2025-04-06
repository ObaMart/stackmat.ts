type RawSignal = [number, number, number, number, number, number]
export type Signal = [string, string, string, string, string, string]
const ZERO_SIGNAL: Signal = ["0", "0", "0", "0", "0", "0"]

class SignalDecoder {
  static validArr(charCodes: RawSignal): boolean {
    return charCodes.every((charCode) => charCode >= 48 && charCode <= 57) // 48: "0", 57: "9" -> This checks if all values are digits
  }

  static decode(data: number[]): Signal | undefined {
    for (let i = 0; i <= 3; i++) {
      const charCodeSubArr = data.slice(i, i+6) as RawSignal;
      if (SignalDecoder.validArr(charCodeSubArr)) {
        return charCodeSubArr.map((charCode: number) => String.fromCharCode(charCode)) as Signal;
      }
    }
    return undefined;
  }
};

class AudioHardware {
  source: MediaStreamAudioSourceNode;
  callback: (signal: Float32Array<ArrayBufferLike>) => void;

  constructor(source: MediaStreamAudioSourceNode, callback: (signal: Float32Array<ArrayBufferLike>) => void) {
    this.source = source;
    const node = source.context.createScriptProcessor(4096 * 2, 1, 1);
    this.callback = callback;
    node.onaudioprocess = e => this.callback(e.inputBuffer.getChannelData(0));
    source.connect(node);
    node.connect(source.context.destination);
  }
};

class RS232Decoder {
  ticksPerBit: number;

  constructor(ticksPerBit: number) {
    this.ticksPerBit = ticksPerBit;
  }

  static floatSignalToBinary(signal: number) {
    if (signal < 0) {
      return 1;
    }
    if (signal > 0) {
      return 0;
    }
    return undefined;
  }

  findBeginningOfSignal(data: Float32Array<ArrayBufferLike>) {
    let oneCount = 0;
    let waitingForZero = false;
    for (let i = 0; i < data.length; i++) {
      const bit = data[i];
      if (bit === 1) {
        oneCount += 1;
      }
      if (oneCount > 9 * this.ticksPerBit) {
        waitingForZero = true;
      }
      if (bit === 0) {
        oneCount = 0;
        if (waitingForZero) {
          return i;
        }
      }
    }
    return undefined;
  }

  static runLengthEncode(data: Float32Array<ArrayBufferLike>) {
    let lastBit = -1;
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (lastBit !== data[i]) {
        result.push({ bit: data[i], length: 1 });
        lastBit = data[i];
      } else {
        result[result.length - 1].length += 1;
      }
    }
    return result;
  }

  static getBitsFromRunLengthEncodedSignal(array: {bit: number, length: number}[], period: number): number[] {
    return array.flatMap(e => {
      const bitsCount = Math.round(e.length / period);
      return Array(bitsCount).fill(e.bit);
    });
  }

  static decodeBits(data: number[], offset: number) {
    let result = 0;
    for (let i = 0; i < 8; i++) {
      result += data[offset + i] << i;
    }
    return result;
  }

  static getPacket(data: number[]) {
    return Array.from({ length: 9 }, (_, i) => this.decodeBits(data, i * 10));
  }

  decode(data: Float32Array<ArrayBufferLike>) {
    const bits = data.map(e => RS232Decoder.floatSignalToBinary(e) ?? 0);
    const startIndex = this.findBeginningOfSignal(bits);
    const runLengthEncoded = RS232Decoder.runLengthEncode(bits.slice(startIndex));
    const decodedBits = RS232Decoder.getBitsFromRunLengthEncodedSignal(runLengthEncoded, this.ticksPerBit);
    return RS232Decoder.getPacket(decodedBits.slice(1));
  }
};

interface TimerOptions {
  onNonSupportedBrowser?: () => void;
  onZero?: () => void;
  onStarting?: () => void;
  onRunning?: () => void;
  onStopping?: () => void;
  onResetting?: () => void;
  signalReceived?: (signal: Signal) => void;
}

export function arrEq<T>(arr1: T[], arr2: T[]) {
  if (arr1.length !== arr2.length) {
    return false;
  }

  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }

  return true;
}

export class StackmatTimer {
  stack: [Signal, Signal, Signal];
  capturing: boolean;
  rs232Decoder: RS232Decoder;
  onNonSupportedBrowser?: () => void;
  onZero?: () => void;
  onStarting?: () => void;
  onRunning?: () => void;
  onStopping?: () => void;
  onResetting?: () => void;
  signalReceived?: (signal: Signal) => void;
  device?: AudioHardware;

  constructor(options: TimerOptions) {
    this.stack = [ZERO_SIGNAL, ZERO_SIGNAL, ZERO_SIGNAL];
    this.capturing = true;
    this.rs232Decoder = new RS232Decoder(StackmatTimer.audioContext().sampleRate / 1200);

    if (!StackmatTimer.supported()) {
      if (options?.onNonSupportedBrowser) {
        options.onNonSupportedBrowser();
      } else {
        alert("You need a recent browser in order to connect your Stackmat Timer.");
      }
      return;
    }

    this.onZero = options.onZero || function() {};
    this.onStarting = options.onStarting || function() {};
    this.onRunning = options.onRunning || function() {};
    this.onStopping = options.onStopping || function() {};
    this.onResetting = options.onResetting || function() {};
    this.signalReceived = options.signalReceived || function() {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const success = (stream: any) => {
      const microphone = StackmatTimer.audioContext().createMediaStreamSource(stream)
      this.device = new AudioHardware(microphone, this.signalFetched.bind(this));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fail = (err: any) => console.log("Fail to connect to audio device", err);

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({
        audio: { advanced: [{ echoCancellation: false, noiseSuppression: false }] }
      }).then(success).catch(fail);
    } else {
      alert("You need a recent browser in order to connect your Stackmat Timer.");
      return;
    }
  }

  pushToStack(signal: Signal) {
    this.stack = [signal, this.stack[0], this.stack[1]];
  }

  isZero() {
    return arrEq(this.stack[0], ZERO_SIGNAL) && arrEq(this.stack[1], ZERO_SIGNAL) && arrEq(this.stack[2], ZERO_SIGNAL);
  }

  isReset() {
    return arrEq(this.stack[0], ZERO_SIGNAL) && !arrEq(this.stack[1], ZERO_SIGNAL);
  }

  isStarting() {
    return !arrEq(this.stack[0], ZERO_SIGNAL) && arrEq(this.stack[1], ZERO_SIGNAL);
  }

  isRunning() {
    return !arrEq(this.stack[0], ZERO_SIGNAL) && !arrEq(this.stack[1], ZERO_SIGNAL) && !arrEq(this.stack[0], this.stack[1]);
  }

  isStopped() {
    return arrEq(this.stack[0], this.stack[1]) && arrEq(this.stack[1], this.stack[2]) && !arrEq(this.stack[0], ZERO_SIGNAL);
  }


  static supported() {
    return !!(this.getUserMedia());
  }

  static getUserMedia() {
    // this raises errors in eslint, but for me the stackmat timer stuff works so idk
    return navigator.mediaDevices.getUserMedia;
  }

  static audioContext() {
    try {
      const context = window.AudioContext;
      return new context();
    } catch (error) {
      console.error('API Audio not supported. :(', error);
      throw new Error('API Audio not supported. :(');
    }
  }

  signalFetched(signal: Float32Array<ArrayBufferLike>) {
    if (this.capturing) {
      const packet = this.rs232Decoder.decode(signal);
      if (!packet) return;

      const decodedSignal = SignalDecoder.decode(packet);
      if (!decodedSignal) return;

      this.pushToStack(decodedSignal);
      // console.log(`Zero: ${this.isZero()}\nReset: ${this.isReset()}\nStarting: ${this.isStarting()}\nRunning: ${this.isRunning()}\nStopped: ${this.isStopped()}`);
      if (this.isZero()) this.onZero?.();
      if (this.isReset()) this.onResetting?.();
      if (this.isStarting()) this.onStarting?.();
      if (this.isRunning()) this.onRunning?.();
      if (this.isStopped()) this.onStopping?.();
      // console.log(decodedSignal);
      
      this.signalReceived?.(decodedSignal);
    }
  }

  start() {
    this.capturing = true;
  }

  stop() {
    this.capturing = false;
  }
};