{
  description = "Newsview — a lightweight news display and container";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      eachSystem = nixpkgs.lib.genAttrs systems;
    in {
      packages = eachSystem (system:
        let
          pkgs = import nixpkgs { inherit system; };
          newsview = pkgs.callPackage ./nix/package.nix { };
        in {
          inherit newsview;
          default = newsview;
          container = pkgs.dockerTools.buildLayeredImage {
            name = "newsview";
            tag = "0.1.0";
            contents = [ newsview pkgs.cacert pkgs.dockerTools.fakeNss ];
            extraCommands = ''
              mkdir -p var/cache/newsview tmp
              chmod 1777 tmp
            '';
            fakeRootCommands = ''
              chown 10001:10001 var/cache/newsview
            '';
            config = {
              User = "10001:10001";
              Cmd = [ "${newsview}/bin/newsview-server" ];
              Env = [ "HOST=0.0.0.0" "PORT=3080" "NODE_ENV=production" "NEWSVIEW_CACHE_DIR=/var/cache/newsview" ];
              ExposedPorts."3080/tcp" = { };
              Volumes."/var/cache/newsview" = { };
              WorkingDir = "/var/cache/newsview";
            };
          };
        });
      devShells = eachSystem (system:
        let
          pkgs = import nixpkgs { inherit system; };
          common = with pkgs; [ nodejs_24 bash coreutils curl util-linux shellcheck ];
        in {
          default = pkgs.mkShell { packages = common ++ [ pkgs.firefox ]; };
          server = pkgs.mkShell { packages = common; };
        });
      apps = eachSystem (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.newsview}/bin/newsview-server";
          meta.description = "Run the Newsview production server";
        };
      });
      checks = eachSystem (system: {
        inherit (self.packages.${system}) newsview;
      });
      nixosModules.default = import ./nix/module.nix self;
    };
}
