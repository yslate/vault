import { useEffect, useState } from "react";
import Vibrant from "node-vibrant";

export function useColorExtractor(imageUrl: string | undefined): string[] {
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    if (!imageUrl) {
      setColors([]);
      return;
    }

    let cancelled = false;

    Vibrant.from(imageUrl)
      .getSwatches()
      .then((swatches) => {
        if (cancelled) return;
        const extracted: string[] = [];
        for (const swatch in swatches) {
          if (Object.prototype.hasOwnProperty.call(swatches, swatch) && swatches[swatch]) {
            extracted.push(swatches[swatch]!.getHex());
          }
        }
        setColors(extracted);
      })
      .catch(() => {
        // ignore extraction errors
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return colors;
}
