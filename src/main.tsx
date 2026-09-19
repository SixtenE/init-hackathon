import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* <App /> */}
    <Portfolio />
  </StrictMode>,
);

function Portfolio() {
  return (
    <div className="container mx-auto flex flex-col h-screen py-16">
      <img
        src="https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fimg.freepik.com%2Fpremium-photo%2Fgolden-sunset-oceans-horizon_1099965-65347.jpg%3Fw%3D996&f=1&nofb=1&ipt=16e174f5b0dda157965e586737582a848cfd18af1af402d0afaa1d7b84936834"
        alt="Profile"
        className="w-60 ml-auto h-80 aspect-square object-cover"
      />
      <h1 className="text-[10rem] leading-32 text-neutral-950 -mt-16">
        Product <br />
        Designer
      </h1>
      <p className="text-md text-neutral-700 -mt-16 text-right">
        Hi, I'm Duwy. A UI/UX <br /> Designer Creating <br /> Intuitive Digital{" "}
        <br /> Experiences
      </p>
    </div>
  );
}
