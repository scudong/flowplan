// happy-dom's Window installs a node:vm context in its constructor; workerd's
// node:vm cannot contextify an arbitrary object ("contextifiedObject must be
// an instance of vm.Context"), so @tiptap/html's server rendering crashes on
// Workers. Nothing in the server path evaluates scripts — @tiptap/html passes
// disableJavaScriptEvaluation — so the VM setup is skipped there. Node keeps
// the original behaviour.
//
// The patch must live in the same bundle as @tiptap/html itself: the worker
// entry point and the Next bundle each carry their own happy-dom copy, so
// patching from cloud/app-do.ts reaches the wrong one. Importing this module
// right before "@tiptap/html/server" puts it in that bundle.
import { BrowserWindow, PropertySymbol } from "happy-dom";

if (process.env.FLOWPLAN_CLOUD_DB === "1") {
  const prototype = BrowserWindow.prototype as unknown as Record<symbol, () => void>;
  prototype[PropertySymbol.setupVMContext as unknown as symbol] = function () {};
}
