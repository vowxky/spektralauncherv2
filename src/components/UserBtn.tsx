import { useAuth } from "../stores/authContext";
import {
  Dropdown,
  Button,
} from "@heroui/react";
import { IconLogout } from "@tabler/icons-react";

export default function UserBtn() {
  const { authReady, user, logout } = useAuth();

  if (!authReady) return null;

  const displayName = user?.minecraft?.name || "No has iniciado sesión";

  return (
    <Dropdown>
      <Button
        variant="ghost"
        size="lg"
        className="h-10 gap-2 bg-transparent! px-0 py-1 shadow-none! hover:bg-transparent! data-[hover=true]:bg-transparent!"
      >
          {user && (
            <img
              src={`https://mc-heads.net/avatar/${user.minecraft.uuid}/32`}
              alt=""
              referrerPolicy="no-referrer"
              className="size-8 rounded"
            />
          )}
          <span className="max-w-32 truncate text-sm font-semibold text-foreground">
            {displayName}
          </span>
        </Button>

        <Dropdown.Popover className="min-w-64">
          <Dropdown.Menu>
            <Dropdown.Item
              id="sign-out"
              variant="danger"
              className="data-[hover=true]:bg-danger/40"
              onPress={logout}
            >
              <div className="flex items-center gap-2">
                <IconLogout className="w-4 h-4" />
                <span>Cerrar sesión</span>
              </div>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
  );
}