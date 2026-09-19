export function Portfolio() {
  return (
    <section className="relative h-screen snap-start bg-white">
      <div className="container mx-auto p-8 flex h-full flex-col py-16">
        <img
          src="/portfolio-headshot.jpg"
          alt="Profile"
          className="ml-auto rounded-md h-80 w-60 aspect-square object-cover"
        />
        <h1 className="text-[10rem] leading-32 text-neutral-950 -mt-16">
          Sixten <br />
          Ekblad
        </h1>
        <p className="text-md px-32 -mt-16 text-right text-neutral-700">
          Hello, I'm Sixten. A Full Stack <br /> Developer Creating <br />{" "}
          Intuitive revolutionary <br /> Applications
        </p>
      </div>
      <p className="absolute bottom-8 left-1/2 -translate-x-1/2 text-sm tracking-wide text-neutral-400">
        Scroll
      </p>
    </section>
  );
}
