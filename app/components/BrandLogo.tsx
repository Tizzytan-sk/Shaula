"use client";

import Image from "next/image";
import { memo } from "react";

interface BrandLogoProps {
  size: number;
  className?: string;
}

function BrandLogoComponent({ size, className }: BrandLogoProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "0 0 auto",
      }}
    >
      <Image
        src="/brand/shaula-scorpion-256.png"
        alt=""
        width={256}
        height={256}
        draggable={false}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </span>
  );
}

export const BrandLogo = memo(BrandLogoComponent);
