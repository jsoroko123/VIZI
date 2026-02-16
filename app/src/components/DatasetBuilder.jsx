import ReportDesigner from "./ReportDesigner";

export default function DatasetBuilder({ embedded = false }) {
  return (
    <ReportDesigner
      embedded={embedded}
      initialEditorTab="datasets"
      lockEditorTab
      hideTopTabs
      datasetOnly
      titleOverride="Dataset Builder"
    />
  );
}
