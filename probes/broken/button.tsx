import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const variants = {
  default: "bg-primary text-primary-foreground",
  outline: "border border-input bg-background",
};
const sizes = {
  default: "h-10 px-4 py-2",
  sm: "h-8 px-3",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export const Button = ({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) => (
  <button
    className={cn(
      "inline-flex items-center justify-center rounded-md text-sm font-medium",
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
);

export const RestyledButton = () => <Button className="p-4">Hi</Button>;
