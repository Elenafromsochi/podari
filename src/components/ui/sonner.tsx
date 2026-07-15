import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Уведомления в нашей тёплой гамме: успех — оливково-зелёный (mint),
          // ошибка — мягкая, читаемая (без неонового красного фона).
          success:
            "group-[.toaster]:!bg-mint group-[.toaster]:!text-mint-foreground group-[.toaster]:!border-mint [&_[data-icon]]:!text-mint-foreground",
          error:
            "group-[.toaster]:!bg-background group-[.toaster]:!text-destructive group-[.toaster]:!border-destructive/40 [&_[data-icon]]:!text-destructive",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
