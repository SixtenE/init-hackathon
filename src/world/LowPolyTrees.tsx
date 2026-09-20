import { Instance, Instances } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { PropModelId } from "./cityAssetCatalog";
import type { MapProp } from "./map";

const TREE_HEIGHT: Record<string, number> = {
  "tree-02": 7.2,
  "tree-04": 3.2,
  "tree-05": 6.4,
};

type TreeKind = "round" | "bush";
type PlacedTree = {
  id: string;
  x: number;
  z: number;
  rotation: number;
  height: number;
  kind: TreeKind;
};

const trunkGeometry = new THREE.CylinderGeometry(1, 1.35, 1, 6);
trunkGeometry.translate(0, 0.5, 0);

const roundGeometry = new THREE.IcosahedronGeometry(1, 0);

const bushGeometry = new THREE.DodecahedronGeometry(1, 0);

const trunkMaterial = new THREE.MeshLambertMaterial({ color: "#5c4030" });
const roundMaterial = new THREE.MeshLambertMaterial({ color: "#3d8c36" });
const bushMaterial = new THREE.MeshLambertMaterial({ color: "#4a9a3c" });

function treeKind(model: PropModelId): TreeKind {
  return model === "tree-04" ? "bush" : "round";
}

function placeTrees(trees: MapProp[]): PlacedTree[] {
  return trees.map((tree) => ({
    id: tree.id,
    x: tree.x,
    z: tree.z,
    rotation: tree.rotation,
    height: (TREE_HEIGHT[tree.model] ?? 6.4) * tree.scale,
    kind: treeKind(tree.model),
  }));
}

export function LowPolyTrees({ trees }: { trees: MapProp[] }) {
  const placed = useMemo(() => placeTrees(trees), [trees]);
  const rounds = placed.filter((tree) => tree.kind === "round");
  const bushes = placed.filter((tree) => tree.kind === "bush");

  return (
    <group>
      <Instances geometry={trunkGeometry} material={trunkMaterial} limit={Math.max(1, rounds.length)}>
        {rounds.map((tree) => {
          const trunkHeight = tree.height * 0.38;
          const radius = tree.height * 0.032;
          return (
            <Instance
              key={`${tree.id}-trunk`}
              position={[tree.x, 0, tree.z]}
              rotation={[0, tree.rotation, 0]}
              scale={[radius, trunkHeight, radius]}
            />
          );
        })}
      </Instances>
      <Instances geometry={roundGeometry} material={roundMaterial} limit={Math.max(1, rounds.length)}>
        {rounds.map((tree) => {
          const radius = tree.height * 0.3;
          return (
            <Instance
              key={tree.id}
              position={[tree.x, tree.height * 0.58, tree.z]}
              rotation={[0, tree.rotation, 0]}
              scale={[radius, radius * 1.05, radius]}
            />
          );
        })}
      </Instances>
      <Instances geometry={bushGeometry} material={bushMaterial} limit={Math.max(1, bushes.length)}>
        {bushes.map((tree) => {
          const radius = tree.height * 0.48;
          return (
            <Instance
              key={tree.id}
              position={[tree.x, radius * 0.85, tree.z]}
              rotation={[0, tree.rotation, 0]}
              scale={[radius, radius * 0.9, radius]}
            />
          );
        })}
      </Instances>
    </group>
  );
}
