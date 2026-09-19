export function Portfolio() {
  return (
    <section className="relative h-screen snap-start overflow-x-hidden bg-white">
      <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center gap-y-6 px-8 pt-16 pb-24 short:gap-y-3 short:pt-8 short:pb-12 lg:grid-cols-3 lg:grid-rows-1 lg:items-center lg:justify-items-stretch lg:gap-x-4 lg:gap-y-0 lg:px-0 lg:py-32 lg:short:py-16">
        <h1 className="text-center text-[clamp(3.5rem,11vw,6.25rem)] leading-[0.85] text-neutral-950 lg:h-full lg:text-right lg:text-[100px] lg:leading-20">
          Sixten
          <br />
          Ekblad
        </h1>
        <img
          src="/portfolio-headshot.jpg"
          alt="Sixten Ekblad"
          className="h-full min-h-0 w-auto max-w-full object-contain object-center lg:max-h-full lg:w-full"
        />
        <p className="text-center text-lg leading-5 text-neutral-700 lg:mt-auto lg:text-left">
          Hello, I&apos;m Sixten. <br />A Full Stack Developer Creating
          <br />
          Intuitive revolutionary <br /> Applications
        </p>
      </div>
      <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-sm tracking-wide text-neutral-400 sm:bottom-8 short:bottom-3">
        Scroll
      </p>
    </section>
  );
}
