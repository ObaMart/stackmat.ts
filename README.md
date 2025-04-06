# stackmat.ts
Interface for the Yuxin Timer V2 in TypeScript, using the HTML Audio API

## Usage
This has only been tested in NextJS 15 using the app router. Put this file in some folder, import it in a client component and make sure the client component is mounted before rendering and creating the timer.
Example:

```typescript
"use client"
import { Signal, StackmatTimer } from "./stackmat";
import { useEffect, useState } from "react";

export default function Timer() {
    const [mounted, setMounted] = useState(false);
    const [time, setTime] = useState("0:00.000");
    
    const handleSignal = (signal: Signal) => {
        setTime(`${signal[0]}:${signal[1]}${signal[2]}.${signal[3]}${signal[4]}${signal[5]}`);
    }

    // optionally put your handleStart, handleStop, handleReset here
    
    useEffect(() => {
        setMounted(true); // runs when loading the client component, make sure the component is loaded so the StackmatTimer can access the audio API
    }, [])
    if (!mounted) return <></>

    const timer = new StackmatTimer({
        signalReceived: handleSignal,
        onStarting: handleStart,
        onStopping: handleStop,
        onResetting: handleReset,
        onNonSupportedBrowser: () => { alert("This browser does not work with the stackmat timer.") }
    });

    return <p>{time}</p>
}
```
