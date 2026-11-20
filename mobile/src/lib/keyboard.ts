// The on-screen keyboard's height, so forms and the chat composer sit above it on both
// platforms. Android draws edge to edge (the window doesn't resize by itself) and reports the
// keyboard's height without the navigation bar the window also extends under, so that bar's
// height is added: without it the bottom of the screen stays hidden behind the keyboard.
import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height ? height + (Platform.OS === "android" ? insets.bottom : 0) : 0;
}
