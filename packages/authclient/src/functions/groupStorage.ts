import fs from "fs"
import path from "path"

const groupDirPath = path.join(__dirname, "../storage/group")

const membersFilePath = path.join(groupDirPath, "members.json")

type Members = { [groupId: string]: { [treeIndex: string]: string[] } }

export async function loadMembers(): Promise<Members> {
    if (!fs.existsSync(groupDirPath)) {
        fs.mkdirSync(groupDirPath, { recursive: true })
    }

    if (!fs.existsSync(membersFilePath)) {
        fs.writeFileSync(membersFilePath, JSON.stringify({}, null, 2), "utf-8")
        return {}
    }
    const data = fs.readFileSync(membersFilePath, "utf-8")
    // console.log("\nReading the file :", new Date().toISOString())

    return JSON.parse(data)
}

export function saveMembers(members: Members) {
    if (!fs.existsSync(groupDirPath)) {
        fs.mkdirSync(groupDirPath, { recursive: true })
    }

    if (!fs.existsSync(membersFilePath)) {
        fs.writeFileSync(membersFilePath, JSON.stringify({}, null, 2), "utf-8")
    }

    fs.writeFileSync(membersFilePath, JSON.stringify(members, null, 2), "utf-8")
    // console.log("\nWriting in the file :", new Date().toISOString())
}

export function addMember(members: Members, groupId: string, identityCommitment: string, treeIndex: string) {
    if (!members[groupId]) members[groupId] = {}
    if (!members[groupId][treeIndex]) members[groupId][treeIndex] = []
    if (!members[groupId][treeIndex].includes(identityCommitment)) {
        members[groupId][treeIndex].push(identityCommitment)
    }
}

export function removeMember(members: Members, groupId: string, identityCommitment: string, treeIndex: string) {
    if (!members[groupId] || !members[groupId][treeIndex]) return
    members[groupId][treeIndex] = members[groupId][treeIndex].filter((id) => id !== identityCommitment)
}

export function updateMember(
    members: Members,
    groupId: string,
    oldIdentityCommitment: string,
    newIdentityCommitment: string,
    treeIndex: string
) {
    if (!members[groupId] || !members[groupId][treeIndex]) return
    const index = members[groupId][treeIndex].indexOf(oldIdentityCommitment)
    if (index !== -1) {
        members[groupId][treeIndex][index] = newIdentityCommitment
    }
}

const groupsFile = path.join(groupDirPath, "IDs.json")

type GroupInfo = {
    groupId: string
    subgroups: string[]
}

export function saveGroupId(groupId: string, treeIndex?: string) {
    if (!fs.existsSync(groupDirPath)) {
        fs.mkdirSync(groupDirPath, { recursive: true })
    }

    let groupIds: GroupInfo[] = []

    if (fs.existsSync(groupsFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(groupsFile, "utf-8"))
            if (Array.isArray(data)) {
                groupIds = data
            } else {
                console.warn("Invalid content in groupsFile. Overwriting with an empty array.")
            }
        } catch (e) {
            console.error("Error parsing groupsFile:", e)
        }
    }

    let group = groupIds.find((g) => g.groupId === groupId)
    if (!group) {
        group = { groupId, subgroups: [] }
        groupIds.push(group)
    }

    if (treeIndex && !group.subgroups.includes(treeIndex)) {
        group.subgroups.push(treeIndex)
    }

    fs.writeFileSync(groupsFile, JSON.stringify(groupIds, null, 2))
}

export function getAllGroupIds(): GroupInfo[] {
    if (!fs.existsSync(groupDirPath)) {
        fs.mkdirSync(groupDirPath, { recursive: true })
    }

    if (!fs.existsSync(groupsFile)) {
        fs.writeFileSync(groupsFile, JSON.stringify([], null, 2), "utf-8")
        return []
    }

    return JSON.parse(fs.readFileSync(groupsFile, "utf-8"))
}

export function getMySubtree(groupId: string): string | undefined {
    if (!fs.existsSync(groupsFile)) return undefined

    try {
        const groupIds: { groupId: string; subgroups?: string[] }[] = JSON.parse(fs.readFileSync(groupsFile, "utf-8"))

        const group = groupIds.find((g) => g.groupId === groupId)
        if (!group || !group.subgroups || group.subgroups.length === 0) return undefined

        return group.subgroups[0]
    } catch (e) {
        console.error("Error reading groups file:", e)
        return undefined
    }
}
