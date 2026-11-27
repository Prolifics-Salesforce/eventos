/** Shown in place of a screen the signed-in person's role does not include. */
export function Denied({ title }: { title: string }) {
  return (
    <>
      <div className="head"><div><h1>{title}</h1></div></div>
      <div className="notice quiet">Your role does not include this screen. Ask an administrator if you need it.</div>
    </>
  );
}
