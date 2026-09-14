import { useAppController } from "./src/controllers/useAppController";
import { AppView } from "./src/views/AppView";

export default function App() {
  return <AppView controller={useAppController()} />;
}
