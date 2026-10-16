self: { config, lib, pkgs, ... }:
let
  cfg = config.services.newsview;
  settings = pkgs.writeText "newsview-config.json" (builtins.toJSON cfg.settings);
in {
  options.services.newsview = {
    enable = lib.mkEnableOption "the Newsview container";
    port = lib.mkOption { type = lib.types.port; default = 3080; description = "Loopback port for the Newsview display."; };
    settings = lib.mkOption {
      type = lib.types.attrs;
      default = builtins.fromJSON (builtins.readFile ../config/default.json);
      description = "Initial display settings; the dedicated browser can override these locally.";
    };
  };
  config = lib.mkIf cfg.enable {
    virtualisation.podman.enable = true;
    virtualisation.oci-containers = {
      backend = "podman";
      containers.newsview = {
        image = "newsview:0.1.0";
        imageFile = self.packages.${pkgs.stdenv.hostPlatform.system}.container;
        ports = [ "127.0.0.1:${toString cfg.port}:3080" ];
        volumes = [ "/var/lib/newsview:/var/cache/newsview" "${settings}:/etc/newsview.json:ro" ];
        environment.NEWSVIEW_CONFIG = "/etc/newsview.json";
      };
    };
    systemd.tmpfiles.rules = [ "d /var/lib/newsview 0750 10001 10001 -" ];
  };
}
