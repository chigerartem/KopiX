interface Props {
  message: string;
}

export function ErrorMessage({ message }: Props) {
  return (
    <div
      style={{
        background: "rgba(233,92,92,0.15)",
        border: "1px solid var(--destructive)",
        borderRadius: "0.5rem",
        padding: "0.75rem 1rem",
        color: "var(--destructive)",
        fontSize: "0.9rem",
      }}
    >
      {message}
    </div>
  );
}
