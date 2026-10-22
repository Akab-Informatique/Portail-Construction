import { useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FolderTreePanel, type BrowseFolder } from "@/components/project/FolderTreePanel";

export type { BrowseFolder };

export function FolderTreeMenu({
  folders,
  driveId,
  currentKey,
  onOpen,
}: {
  folders: BrowseFolder[];
  driveId: string;
  currentKey: string;
  onOpen: (root: BrowseFolder, trail: { id: string; name: string }[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <FolderOpen className="size-4" />
          {t("sp.folderTree")}
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-2">
        <FolderTreePanel
          folders={folders}
          driveId={driveId}
          currentKey={currentKey}
          onOpen={(root, trail) => {
            onOpen(root, trail);
            setOpen(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
