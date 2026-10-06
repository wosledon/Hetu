using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkProjectSsh : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ConnectionType",
                table: "WorkProjects",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "Local");

            migrationBuilder.AddColumn<string>(
                name: "SshAuthType",
                table: "WorkProjects",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "Key");

            migrationBuilder.AddColumn<string>(
                name: "SshHost",
                table: "WorkProjects",
                type: "TEXT",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SshKeyPath",
                table: "WorkProjects",
                type: "TEXT",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SshPasswordProtected",
                table: "WorkProjects",
                type: "TEXT",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SshPort",
                table: "WorkProjects",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "SshUser",
                table: "WorkProjects",
                type: "TEXT",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ConnectionType",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshAuthType",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshHost",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshKeyPath",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshPasswordProtected",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshPort",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshUser",
                table: "WorkProjects");
        }
    }
}
