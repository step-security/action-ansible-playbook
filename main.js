const core = require('@actions/core')
const exec = require('@actions/exec')
const yaml = require('yaml')
const fs = require('fs')
const os = require('os')
const axios = require('axios')

async function validateSubscription() {
  let repoPrivate;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    repoPrivate = payload?.repository?.private;
  }

  const upstream = 'Arqu/action-ansible-playbook';
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';
  core.info('');
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m');
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info('');
  if (repoPrivate === false) return;
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const body = { action: action || '' };
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl;
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body, { timeout: 3000 }
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      core.error(`\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`);
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
      process.exit(1);
    }
    core.info('Timeout or API not reachable. Continuing to next step.');
  }
}

async function main() {
    try {
        await validateSubscription();
        const playbook = core.getInput("playbook", { required: true })
        const requirements = core.getInput("requirements")
        const directory = core.getInput("directory")
        const key = core.getInput("key")
        const inventory = core.getInput("inventory")
        const vaultPassword = core.getInput("vault_password")
        const knownHosts = core.getInput("known_hosts")
        const options = core.getInput("options")
        const sudo    = core.getInput("sudo")
        const noColor = core.getInput("no_color")

        let cmd = ["ansible-playbook", playbook]

        if (options) {
            cmd.push(...options.split(/\s+/).filter(arg => arg))
        }

        if (directory) {
            process.chdir(directory)
            core.saveState("directory", directory)
        }

        if (requirements) {
            const requirementsContent = fs.readFileSync(requirements, 'utf8')
            const requirementsObject = yaml.parse(requirementsContent)

            if (Array.isArray(requirementsObject)) {
                await exec.exec("ansible-galaxy", ["install", "-r", requirements])
            } else {
                if (requirementsObject.roles)
                    await exec.exec("ansible-galaxy", ["role", "install", "-r", requirements])
                if (requirementsObject.collections)
                    await exec.exec("ansible-galaxy", ["collection", "install", "-r", requirements])
            }
        }

        if (key) {
            const keyFile = ".ansible_key"
            fs.writeFileSync(keyFile, key + os.EOL, { mode: 0600 })
            core.saveState("keyFile", keyFile)
            cmd.push("--key-file")
            cmd.push(keyFile)
        }

        if (inventory) {
            const inventoryFile = ".ansible_inventory"
            fs.writeFileSync(inventoryFile, inventory, { mode: 0600 })
            core.saveState("inventoryFile", inventoryFile)
            cmd.push("--inventory-file")
            cmd.push(inventoryFile)
        }

        if (vaultPassword) {
            const vaultPasswordFile = ".ansible_vault_password"
            fs.writeFileSync(vaultPasswordFile, vaultPassword, { mode: 0600 })
            core.saveState("vaultPasswordFile", vaultPasswordFile)
            cmd.push("--vault-password-file")
            cmd.push(vaultPasswordFile)
        }

        if (knownHosts) {
            const knownHostsFile = ".ansible_known_hosts"
            fs.writeFileSync(knownHostsFile, knownHosts, { mode: 0600 })
            core.saveState("knownHostsFile", knownHostsFile)
            cmd.push("--ssh-common-args")
            cmd.push(`-o UserKnownHostsFile=${knownHostsFile}`)
            process.env.ANSIBLE_HOST_KEY_CHECKING = "True"
        } else {
            process.env.ANSIBLE_HOST_KEY_CHECKING = "False"
        }

        if (sudo) {
            cmd.unshift("sudo", "-E", "env", `PATH=${process.env.PATH}`)
        }

        if (noColor) {
            process.env.ANSIBLE_NOCOLOR = "True"
        } else {
            process.env.ANSIBLE_FORCE_COLOR = "True"
        }

        let output = ""
        await exec.exec(cmd[0], cmd.slice(1), {
          listeners: {
            stdout: function(data) {
              output += data.toString()
            },
            stderr: function(data) {
              output += data.toString()
            }
          }
        })
        core.setOutput("output", output)
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()
