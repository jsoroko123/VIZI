import AppsRounded from "@mui/icons-material/AppsRounded";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import BoltRounded from "@mui/icons-material/BoltRounded";
import BuildRounded from "@mui/icons-material/BuildRounded";
import BusinessRounded from "@mui/icons-material/BusinessRounded";
import DescriptionRounded from "@mui/icons-material/DescriptionRounded";
import ExpandMore from "@mui/icons-material/ExpandMore";
import FilterAltRounded from "@mui/icons-material/FilterAltRounded";
import FolderRounded from "@mui/icons-material/FolderRounded";
import HelpOutline from "@mui/icons-material/HelpOutline";
import InboxRounded from "@mui/icons-material/InboxRounded";
import InsertDriveFileRounded from "@mui/icons-material/InsertDriveFileRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import KeyboardArrowDownRounded from "@mui/icons-material/KeyboardArrowDownRounded";
import MonitorRounded from "@mui/icons-material/MonitorRounded";
import NotificationsActiveRounded from "@mui/icons-material/NotificationsActiveRounded";
import ScienceRounded from "@mui/icons-material/ScienceRounded";
import SettingsRounded from "@mui/icons-material/SettingsRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import StorageRounded from "@mui/icons-material/StorageRounded";
import TableChartRounded from "@mui/icons-material/TableChartRounded";
import TimelineRounded from "@mui/icons-material/TimelineRounded";

const ICON_COMPONENTS = {
  AppsRounded,
  AutoAwesome,
  AutoAwesomeRounded,
  BoltRounded,
  BuildRounded,
  BusinessRounded,
  DescriptionRounded,
  ExpandMore,
  FilterAltRounded,
  FolderRounded,
  HelpOutline,
  InboxRounded,
  InsertDriveFileRounded,
  Inventory2Rounded,
  KeyboardArrowDownRounded,
  MonitorRounded,
  NotificationsActiveRounded,
  ScienceRounded,
  SettingsRounded,
  ShowChartRounded,
  StorageRounded,
  TableChartRounded,
  TimelineRounded,
};

export const MATERIAL_ICON_NAMES = Object.keys(ICON_COMPONENTS).sort((a, b) => a.localeCompare(b));
export const MATERIAL_ICON_NAMES_LOWER_MAP = new Map(
  MATERIAL_ICON_NAMES.map((name) => [name.toLowerCase(), name])
);

export function DynamicMaterialIcon({ name, fallback: FallbackIcon = HelpOutline, ...rest }) {
  const normalizedName = String(name || "").trim();
  const IconComp = ICON_COMPONENTS[normalizedName] || FallbackIcon;
  return <IconComp {...rest} />;
}

export const MaterialFallbackIcon = HelpOutline;
export const MaterialAutoAwesomeRoundedIcon = AutoAwesomeRounded;
export const MaterialAutoAwesomeIcon = AutoAwesome;
export const MaterialKeyboardArrowDownRoundedIcon = KeyboardArrowDownRounded;
export const MaterialExpandMoreIcon = ExpandMore;
export const MaterialAppsRoundedIcon = AppsRounded;
